import process from "node:process";
import fsp from "node:fs/promises";
import path from "node:path";
import child_process from "node:child_process";
import util from "node:util";

import semver from "semver";

/**
 * @param {string} command Command to execute
 * @param {string[]} args Command arguments
 * @param {Pick<child_process.SpawnOptions,['cwd']>&{stdout?: 'pipe', stderr?: 'pipe'}} [options] Additional options
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} Program output
 */
function exec(command, args, options = undefined) {
  const stdoutArr = [];
  const stderrArr = [];

  const {
    cwd = undefined,
    stdout = undefined,
    stderr = undefined,
  } = options ?? {};

  const p = child_process.spawn(command, args, {
    shell: true,
    windowsVerbatimArguments: false,
    cwd,
  });
  return new Promise((resolve, reject) => {
    if (stdout === "pipe") p.stdout.pipe(process.stdout);
    else p.stdout.on("data", (data) => stdoutArr.push(data));
    if (stderr === "pipe") p.stderr.pipe(process.stderr);
    else p.stderr.on("data", (data) => stderrArr.push(data));
    p.on("close", (code) =>
      resolve({
        code: code ?? -1,
        stdout: stdoutArr.join(""),
        stderr: stderrArr.join(""),
      })
    );
  });
}

/**
 * Same as `exec`, but pipes stdout & stderr, and throws on error.
 * @param {string} command Command to execute
 * @param {string[]} args Command arguments
 * @param {Pick<child_process.SpawnOptions,['cwd']>} [options] Additional options
 * @returns {void}
 */
async function execPipe(command, args, options = undefined) {
  const { code } = await exec(command, args, {
    stdout: "pipe",
    stderr: "pipe",
    ...(options ?? {}),
  });
  if (code !== 0) throw new Error(`${command} command failed`);
}

/**
 * Same as above, but
 *
 * @param {string[]} args Npm arguments. `--json` will be added to the list.
 * @param {Parameters<exec>[2]} options Options to pass to `exec`
 * @returns {any} Resulting JSON
 */
async function npm(args, options) {
  const { code, stdout, stderr } = await exec(
    "npm",
    [...args, "--json"],
    options
  );
  if (code !== 0) throw new Error(`npm command failed:\n${stderr}`);
  return JSON.parse(stdout);
}

const { values: args } = util.parseArgs({
  allowPositionals: false,
  strict: true,
  options: {
    type: {
      type: "string",
    },
  },
});

const cwd = process.cwd();
const packages = (await npm(["query", ".workspace"])).filter(
  (pkg) =>
    !pkg.private && pkg.path !== cwd && pkg.name.startsWith("@ygg.tools/")
);

// --dirty & --broken are intentionally omitted
const gitDescribe = await exec("git", ["describe", "--always", "--tags"]);
if (gitDescribe.code !== 0)
  throw new Error(`git command failed:\n${gitDescribe.stderr}`);
const gitVersion = gitDescribe.stdout.trim();

const gitRevParse = await exec("git", ["rev-parse", "HEAD"]);
if (gitRevParse.code !== 0)
  throw new Error(`git command failed:\n${gitRevParse.stderr}`);
const gitHead = gitRevParse.stdout.trim();

//const dateStamp = new Date().toISOString().split("T", 1)[0].replaceAll("-", "");

async function changePackageOptions(pkg, optionsNew) {
  // this is a bit hacky, but alas `npm version` is broken because we've renamed the package
  const packageFName = path.join(pkg.path, "package.json");
  const packageJSON = JSON.parse(
    await fsp.readFile(packageFName, { encoding: "utf-8" })
  );
  const optionsOld = Object.fromEntries(
    [...Object.keys(optionsNew)].map((k) => [k, pkg[k]])
  );

  // we only write the file if there was a mismatch
  if (
    [...Object.keys(optionsNew)].findIndex(
      (k) => packageJSON[k] !== optionsNew[k]
    ) !== -1
  ) {
    Object.assign(packageJSON, optionsNew);
    await fsp.writeFile(
      packageFName,
      JSON.stringify(packageJSON, null, 2) + "\n",
      { encoding: "utf-8" }
    );
    return optionsOld;
  }

  return null;
}

/**
 * @type {Map<string,any>}
 */
const packagesToRelease = new Map();

try {
  switch (args.type) {
    case "ci":
      console.log("Updating package versions:");
      // run version updates in parallel
      await Promise.all(
        packages.map(async (pkg) => {
          const vold = pkg.version;
          const vnew = semver.inc(
            vold,
            "prerelease",
            `git.${gitVersion}`,
            false
          );
          console.log(
            `\t${pkg.name}: ${vold} ${vnew ? `-> ${vnew}` : "[no change]"}`
          );
          if (vnew) {
            await changePackageOptions(pkg, {
              version: vnew,
              gitHead,
            });

            // check if package version exists online; if it doesn't, schedule submission
            const pkgFullName = `${pkg.name}@${vnew}`;
            // we don't (necessarily) want to error out on fail, hence manual `npm` call
            const { code, stdout, stderr } = await exec("npm", [
              "view",
              pkgFullName,
              "name",
              "--json",
            ]);
            if (code !== 0) {
              const json = JSON.parse(stdout);
              if (json?.error?.code !== "E404")
                // this is the only error we expect
                throw new Error(`npm command failed:\n${stderr}`);
              // E404 => no package@version found, so we'll release this one
              packagesToRelease.set(pkgFullName, pkg);
            }
          }
        })
      );

      console.log();
      console.log("Submitting:");

      // we need to run prepublishOnly/postpublish manually
      await execPipe("npm", ["run", "prepublishOnly"]);
      try {
        await execPipe("npm", [
          ...packages.flatMap((pkg) => ["--workspace", pkg.location]),
          "publish",
          "--no-git-checks",
          "--tag",
          "ci",
        ]);
      } finally {
        await execPipe("npm", ["run", "postpublish"]);
      }

      break;
    default:
      throw new Error(`--type is required and must be one of: {ci}`);
  }

  // set `edge` tag, which is set unconditionally on all builds

  // for consistency with above and consistency between runs, sort packageKeys
  const packageKeys = [...packagesToRelease.keys()].sort();

  console.log();
  console.log("Updating dist-tags (`edge`):");
  await Promise.all(
    packageKeys.map(async (pkgFullName) => {
      //console.log(`\t${pkgFullName}`);
      await execPipe("npm", ["dist-tag", "add", pkgFullName, "edge"]);
    })
  );
} finally {
  console.log();
  console.log("Restoring old package versions:");
  await Promise.all(
    packages.map(async (pkg) => {
      const vold =
        (
          await changePackageOptions(pkg, {
            version: pkg.version,
            gitHead: pkg.gitHead,
          })
        )?.version ?? pkg.version;
      const vnew = vold !== pkg.version ? pkg.version : null;
      console.log(
        `\t${pkg.name}: ${vold} ${vnew ? `-> ${vnew}` : "[no change]"}`
      );
    })
  );
}

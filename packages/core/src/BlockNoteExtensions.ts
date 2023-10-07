import { Extensions, extensions, Extension } from "@tiptap/core";

import { BlockNoteEditor } from "./BlockNoteEditor";

import { Bold } from "@tiptap/extension-bold";
import { Code } from "@tiptap/extension-code";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { Dropcursor } from "@tiptap/extension-dropcursor";
import { Gapcursor } from "@tiptap/extension-gapcursor";
import { HardBreak } from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import { Italic } from "@tiptap/extension-italic";
import { Link } from "@tiptap/extension-link";
import { Strike } from "@tiptap/extension-strike";
import { Text } from "@tiptap/extension-text";
import { Underline } from "@tiptap/extension-underline";
import * as Y from "yjs";
import styles from "./editor.module.css";
import { BackgroundColorExtension } from "./extensions/BackgroundColor/BackgroundColorExtension";
import { BackgroundColorMark } from "./extensions/BackgroundColor/BackgroundColorMark";
import { BlockContainer, BlockGroup, Doc } from "./extensions/Blocks";
import {
  BlockNoteDOMAttributes,
  BlockSchema,
} from "./extensions/Blocks/api/blockTypes";
import { CustomBlockSerializerExtension } from "./extensions/Blocks/api/serialization";
import blockStyles from "./extensions/Blocks/nodes/Block.module.css";
import { Placeholder } from "./extensions/Placeholder/PlaceholderExtension";
import { TextAlignmentExtension } from "./extensions/TextAlignment/TextAlignmentExtension";
import { TextColorExtension } from "./extensions/TextColor/TextColorExtension";
import { TextColorMark } from "./extensions/TextColor/TextColorMark";
import { TrailingNode } from "./extensions/TrailingNode/TrailingNodeExtension";
import UniqueID from "./extensions/UniqueID/UniqueID";

export interface GetExtensionsOptions<BSchema extends BlockSchema> {
  editor: BlockNoteEditor<BSchema>;
  domAttributes: Partial<BlockNoteDOMAttributes>;
  blockSchema: BSchema;
  collaboration?: {
    fragment: Y.XmlFragment;
    user: {
      name: string;
      color: string;
    };
    provider: any;
    renderCursor?: (user: any) => HTMLElement;
  };
}

export interface BlockNoteExtensionGroup {
  group: string; // not using `name` to avoid confusion with $extension.name
  required: boolean;
  extensions: Extensions;
}

/**
 * Get all the Tiptap extensions BlockNote is configured with by default, split into rough groups.
 */
export const getBlockNoteExtensionGroups = <BSchema extends BlockSchema>(
  opts: GetExtensionsOptions<BSchema>
) => {
  const ret: BlockNoteExtensionGroup[] = [
    {
      group: "Core",
      required: true,
      extensions: [
        extensions.ClipboardTextSerializer,
        extensions.Commands,
        extensions.Editable,
        extensions.FocusEvents,
        extensions.Tabindex,
      ],
    },
    {
      group: "DevTools",
      required: true, // ?
      extensions: [Gapcursor],
    },
    {
      group: "DropCursor",
      required: true,
      extensions: [
        Placeholder.configure({
          emptyNodeClass: blockStyles.isEmpty,
          hasAnchorClass: blockStyles.hasAnchor,
          isFilterClass: blockStyles.isFilter,
          includeChildren: true,
          showOnlyCurrent: false,
        }),
        UniqueID.configure({
          types: ["blockContainer"],
        }),
        HardBreak,
        // Comments,
      ],
    },
    {
      group: "Basics",
      required: true,
      extensions: [Text],
    },
    {
      group: "Marks",
      required: false,
      extensions: [
        Bold,
        Code,
        Italic,
        Strike,
        Underline,
        Link,
        TextColorMark,
        TextColorExtension,
        BackgroundColorMark,
        BackgroundColorExtension,
        TextAlignmentExtension,
      ],
    },
    {
      group: "Nodes",
      required: true,
      extensions: [
        Doc,
        BlockContainer.configure({
          domAttributes: opts.domAttributes,
        }),
        BlockGroup.configure({
          domAttributes: opts.domAttributes,
        }),
        ...Object.values(opts.blockSchema).map((blockSpec) =>
          blockSpec.node.configure({
            editor: opts.editor,
            domAttributes: opts.domAttributes,
          })
        ),
        CustomBlockSerializerExtension,
      ],
    },
    {
      group: "Core", // note that we have *two* core groups!
      required: true,
      extensions: [
        Dropcursor.configure({ width: 5, color: "#ddeeff" }),
        // This needs to be at the bottom of this list, because Key events (such as enter, when selecting a /command),
        // should be handled before Enter handlers in other components like splitListItem
        TrailingNode,
      ],
    },
  ];

  if (opts.collaboration) {
    const group: BlockNoteExtensionGroup = {
      group: "Collaboration",
      required: true,
      extensions: [],
    };

    group.extensions.push(
      Collaboration.configure({
        fragment: opts.collaboration.fragment,
      })
    );
    if (opts.collaboration.provider?.awareness) {
      const defaultRender = (user: { color: string; name: string }) => {
        const cursor = document.createElement("span");

        cursor.classList.add(styles["collaboration-cursor__caret"]);
        cursor.setAttribute("style", `border-color: ${user.color}`);

        const label = document.createElement("span");

        label.classList.add(styles["collaboration-cursor__label"]);
        label.setAttribute("style", `background-color: ${user.color}`);
        label.insertBefore(document.createTextNode(user.name), null);

        const nonbreakingSpace1 = document.createTextNode("\u2060");
        const nonbreakingSpace2 = document.createTextNode("\u2060");
        cursor.insertBefore(nonbreakingSpace1, null);
        cursor.insertBefore(label, null);
        cursor.insertBefore(nonbreakingSpace2, null);
        return cursor;
      };
      group.extensions.push(
        CollaborationCursor.configure({
          user: opts.collaboration.user,
          render: opts.collaboration.renderCursor || defaultRender,
          provider: opts.collaboration.provider,
        })
      );
    }

    ret.push(group);
  } else {
    // disable history extension when collaboration is enabled as Yjs takes care of undo / redo
    ret.push({
      group: "History",
      required: false,
      extensions: [History],
    });
  }

  // Editor extensions are always very last (for compatibility with old behaviour)
  ret.push({
    group: "Editor",
    required: true,
    extensions: [
      Extension.create({
        name: "BlockNoteUIExtension",

        addProseMirrorPlugins: () => {
          return [
            opts.editor.sideMenu.plugin,
            opts.editor.formattingToolbar.plugin,
            opts.editor.slashMenu.plugin,
            opts.editor.hyperlinkToolbar.plugin,
            opts.editor.imageToolbar.plugin,
          ];
        },
      }),
    ],
  });

  return ret;
};

/**
 * Get all the Tiptap extensions BlockNote is configured with by default
 */
export const getBlockNoteExtensions = <BSchema extends BlockSchema>(
  opts: GetExtensionsOptions<BSchema>
) => {
  return getBlockNoteExtensionGroups<BSchema>(opts).flatMap(
    (group) => group.extensions
  );
};

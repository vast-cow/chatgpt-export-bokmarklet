# ChatGPT Markdown Export Bookmarklet

This bookmarklet exports a saved ChatGPT conversation as Markdown. It copies
smaller exports to the clipboard and downloads larger exports as a Markdown
(`.md`) file named after the conversation title. The export includes the title,
the original conversation URL, and your messages and ChatGPT's replies from the
current conversation branch. Recognized images and attachments appear as text
placeholders.

## How to use

1. Create a bookmark in your browser and give it a name such as **Export ChatGPT
   to Markdown**.
2. Copy the entire contents of [bookmarklet.txt](bookmarklet.txt), including the
   `javascript:` prefix, into the bookmark's URL field and save it.
3. Sign in to ChatGPT and open a saved conversation.
4. With the conversation page open, click the bookmark to export it. Markdown
   up to and including 512 KiB (524,288 UTF-8 bytes) is copied to the clipboard.
   Larger exports download as a `.md` file named after the conversation title.
5. If automatic copying fails, click **Retry Copy**. If the retry fails, the
   same click starts the `.md` download. Click **Cancel** or press **Esc** to
   stop the export.

## License

This project is licensed under the MIT License.
See [LICENSE](LICENSE) for details.

## Acknowledgments

This project is based in part on
[ChatGPT Markdown Export](https://github.com/thekester/chatgpt-export)
by Avenel Théophile, licensed under the MIT License.

The original project's approach to ChatGPT session
authentication, conversation retrieval, and conversation
tree traversal was used as a reference.

The bookmarklet implementation, Markdown export logic,
and table of contents generation have been adapted or
independently implemented for this project.

This project is an independent implementation and is
not affiliated with or endorsed by the original author.

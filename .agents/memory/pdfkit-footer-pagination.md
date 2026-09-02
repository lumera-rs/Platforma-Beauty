---
name: PDFKit footer pagination
description: PDFKit’s layout margin behavior when adding headers or footers to buffered pages.
---

When adding a footer to a buffered PDFKit page, do not let the text layout engine see the footer as body content below the active bottom margin.

**Why:** PDFKit paginates text that falls below the active margin even when the page is being revisited with `switchToPage`. That can append blank pages and leave the displayed `Strana X od N` total based on the earlier page range.

**How to apply:** Reserve footer space while rendering body content. During the buffered-page footer pass, temporarily allow the footer’s coordinates within that page’s layout margin, then restore the original margin. Validate the final binary with a PDF parser rather than relying only on PDFKit’s buffered range.
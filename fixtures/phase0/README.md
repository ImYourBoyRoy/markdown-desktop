# Phase 0 fixtures

These fixtures exercise the source/render contract before optimization work:

- `selection-mixed.md` combines Unicode, Markdown links/images, raw HTML
  links/images, and a details block.
- The native benchmark generates 10 KiB, 100 KiB, and 500 KiB documents and a
  250-file workspace at runtime, so large test data is deterministic without
  adding a large generated file to the repository.

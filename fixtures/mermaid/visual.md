# Mermaid visual verification

This fixture exercises a real Mermaid fence with labels, branches, and a
previewable rendered diagram.

```mermaid
flowchart TD
    Start([Open Markdown file]) --> Parse[Parse Mermaid fence]
    Parse --> Render{Render successfully?}
    Render -->|Yes| Preview[Show native SVG labels]
    Render -->|No| Error[Show clear source fallback]
    Preview --> Close([Close preview])
```

The expected result is a readable flowchart with visible labels and no blank
node boxes or HTML foreign-object labels.

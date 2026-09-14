import mermaid from 'mermaid';

// Keep a small stable facade as the production asset's entry export. The
// renderer's full internal namespace is not part of this application's API.
export default {
  initialize: mermaid.initialize,
  render: mermaid.render,
};

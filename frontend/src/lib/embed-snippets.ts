type SnippetInput = {
  /** Origen de este frontend: sirve `widget.js` y la página `/widget`. */
  readonly frontendOrigin: string;
  /** Backend alcanzable desde el navegador. */
  readonly apiBase: string;
  readonly widgetKey: string;
};

/** HTML listo para pegar en el sitio del tenant, en los dos modelos de incrustación. */
export function embedSnippets({ frontendOrigin, apiBase, widgetKey }: SnippetInput) {
  const key = encodeURIComponent(widgetKey);
  return {
    script: `<script src="${frontendOrigin}/widget.js" data-key="${widgetKey}" data-api="${apiBase}" async></script>`,
    iframe: `<iframe src="${frontendOrigin}/widget?key=${key}" title="Chat" style="width:380px;height:600px;border:0"></iframe>`,
  };
}

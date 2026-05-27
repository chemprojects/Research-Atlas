/** Notifies all PDF buttons when a paper's download status changes (any screen). */
export const PDF_STATUS_EVENT = "research-atlas-pdf-status";

export function notifyPdfStatusChanged(paperId: string): void {
  window.dispatchEvent(
    new CustomEvent(PDF_STATUS_EVENT, { detail: { paperId: String(paperId) } }),
  );
}

export function subscribePdfStatusChanged(
  listener: (paperId: string) => void,
): () => void {
  const handler = (e: Event) => {
    const id = (e as CustomEvent<{ paperId: string }>).detail?.paperId;
    if (id) listener(id);
  };
  window.addEventListener(PDF_STATUS_EVENT, handler);
  return () => window.removeEventListener(PDF_STATUS_EVENT, handler);
}

import { useEffect, useRef } from "react";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      className="confirm-dialog"
      ref={dialog}
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onCancel();
      }}
    >
      <h2 id="confirm-dialog-title">{title}</h2>
      {description && <p>{description}</p>}
      <div className="confirm-dialog-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>{cancelText}</button>
        <button className="primary-button" type="button" autoFocus onClick={onConfirm}>{confirmText}</button>
      </div>
    </dialog>
  );
}

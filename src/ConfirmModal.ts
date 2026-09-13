import { App, Modal } from "obsidian";

/** Small reusable "are you sure?" modal with a Cancel/confirm button pair. */
export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private message: string,
    private confirmLabel: string,
    private onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { text: this.message });

    const btnRow = contentEl.createDiv({ cls: "st-confirm-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = btnRow.createEl("button", { cls: "st-confirm-danger-btn", text: this.confirmLabel });
    confirmBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

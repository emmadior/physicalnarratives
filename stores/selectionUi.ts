import { defineStore } from "pinia";

export const useSelectionUiStore = defineStore("selectionUi", {
  state: () => ({
    selected: false,
  }),

  actions: {
    setSelected(selected: boolean) {
      this.selected = selected;
    },
  },
});

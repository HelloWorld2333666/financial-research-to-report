// Project store with one change format: Immer patches.
// User edits, undo/redo and AI proposals all go through produceWithPatches/applyPatches,
// so every change is small, describable and reversible (docs/workspace-study/05-architecture.md §2).
import { enablePatches, produce, produceWithPatches, applyPatches } from "immer";
import { useEffect, useState, useRef } from "preact/hooks";

enablePatches();

export function createStore(project) {
  let state = {
    project, rev: 0, history: [], future: [], savedRev: 0,
    ui: { slide: project.slides[0].id, selected: [], panel: "chat", panelOpen: true, panelWidth: 400, focus: false,
          checked: [], preview: null, chartTab: "data" },
  };
  const subs = new Set();
  const emit = () => subs.forEach((f) => f(state));
  const set = (next) => { state = next; emit(); };

  return {
    get: () => state,
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    /** Tracked change: goes into undo history. Returns the patches. */
    commit(label, recipe) {
      const [next, patches, inverse] = produceWithPatches(state.project, recipe);
      if (!patches.length) return [];
      set({ ...state, project: next, rev: state.rev + 1, history: [...state.history.slice(-199), { label, patches, inverse }], future: [] });
      return patches;
    },
    /** Apply patches produced elsewhere (e.g. an accepted proposal) as one undoable step. */
    applyTracked(label, patches) {
      return this.commit(label, (draft) => applyPatches(draft, patches));
    },
    /** Compute a change without committing it (AI proposals). */
    propose(recipe) {
      const [next, patches, inverse] = produceWithPatches(state.project, recipe);
      return { next, patches, inverse };
    },
    /** Untracked change (chat messages, task status): persisted but not undoable. */
    mutate(recipe) { set({ ...state, project: produce(state.project, recipe), rev: state.rev + 1 }); },
    undo() {
      const h = state.history.at(-1); if (!h) return null;
      set({ ...state, project: applyPatches(state.project, h.inverse), rev: state.rev + 1, history: state.history.slice(0, -1), future: [...state.future, h] });
      return h.label;
    },
    redo() {
      const h = state.future.at(-1); if (!h) return null;
      set({ ...state, project: applyPatches(state.project, h.patches), rev: state.rev + 1, future: state.future.slice(0, -1), history: [...state.history, h] });
      return h.label;
    },
    ui(patch) { set({ ...state, ui: { ...state.ui, ...(typeof patch === "function" ? patch(state.ui) : patch) } }); },
    markSaved() { set({ ...state, savedRev: state.rev }); },
    replaceProject(project) { set({ ...state, project, rev: state.rev + 1 }); },
  };
}

/** Subscribe a component to a slice of the store; re-renders only when the slice changes (Object.is). */
export function useStore(store, selector) {
  const [, force] = useState(0);
  const sel = useRef(selector); sel.current = selector;
  const last = useRef(selector(store.get()));
  last.current = selector(store.get());
  useEffect(() => store.subscribe((s) => {
    const next = sel.current(s);
    if (!Object.is(next, last.current)) { last.current = next; force((n) => n + 1); }
  }), [store]);
  return last.current;
}

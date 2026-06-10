import { create } from 'zustand';

const useSessionStore = create((set) => ({
  lastSession: null,
  setLastSession: (session) => set({ lastSession: session }),
  clear: () => set({ lastSession: null }),
}));

export default useSessionStore;

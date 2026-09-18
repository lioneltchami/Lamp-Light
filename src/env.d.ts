/// <reference types="vite/client" />
declare global {
  interface Window {
    lampLight: {
      invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
      activity(): void;
      onUpdateStatus(listener: (status: unknown) => void): () => void;
      onNavigate(listener: (page: string) => void): () => void;
      onShareVotd(listener: () => void): () => void;
    };
  }
}

export {};

// Browser-only stub of next/navigation for the isolated UI fixtures (never used by the app).
export function useSearchParams() {
  return new URLSearchParams(window.location.search);
}

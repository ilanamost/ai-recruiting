<template>
  <div
    class="initial-loader"
    role="status"
    aria-live="polite"
  >
    <span class="initial-loader__spinner" aria-hidden="true"></span>
    <span class="initial-loader__text">Loading your workspace</span>
  </div>
</template>

<style scoped>
.initial-loader {
  display: grid;
  min-height: 100vh;
  width: 100%;
  align-items: center;
  justify-content: center;
  grid-template-columns: 1.5rem max-content;
  column-gap: 0.75rem;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
}

.initial-loader__spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 3px solid var(--primary);
  border-right-color: transparent;
  border-radius: 50%;
  animation: initial-loader-spin 0.8s linear infinite;
}

.initial-loader__text {
  white-space: nowrap;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

@keyframes initial-loader-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .initial-loader__spinner {
    animation-duration: 1.6s;
  }
}
</style>

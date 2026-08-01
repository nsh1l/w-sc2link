<script lang="ts">
  import type { SearchResult } from './types';
  import { platformMeta } from './platforms';

  let { result }: { result: SearchResult } = $props();
  const meta = $derived(platformMeta(result.platform));
</script>

<a class="result-card" href={result.url} target="_blank" rel="noopener noreferrer">
  <div class="thumb-wrap">
    {#if result.thumb}
      <img src={result.thumb} alt="" loading="lazy">
    {:else}
      <div class="thumb-ph">♪</div>
    {/if}
  </div>
  <div class="result-body">
    <span class="badge" style="--pc: {meta.color}">{meta.name}</span>
    <span class="result-title">{result.title}</span>
    <span class="result-artist">{result.artist}</span>
  </div>
  <span class="go" aria-hidden="true">↗</span>
</a>

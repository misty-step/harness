import { getCollection } from 'astro:content';
import { createGraph } from './graph.mjs';

let graph;
export function getGraph() {
  // All pages in a build share one normalized, validated content graph.
  return graph ??= getCollection('repository').then(createGraph);
}

// htm bound to Preact: JSX-like templates without a build step (React-compatible component model).
import { h } from "preact";
import htm from "htm";

export const html = htm.bind(h);

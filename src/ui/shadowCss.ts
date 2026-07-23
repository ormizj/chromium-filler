/**
 * The shared stylesheet text for shadow-DOM surfaces (review modal, setup
 * panel). A shadow root inherits nothing from the page's stylesheets, so each
 * one has to carry its own copy of the tokens and primitives — this is the one
 * place that assembles them, so the two surfaces cannot drift apart again.
 *
 * Light-DOM pages (popup, options) link the same two files from their HTML.
 */

import tokens from './tokens.css?inline';
import primitives from './primitives.css?inline';

export const BASE_CSS = `${tokens}\n${primitives}`;

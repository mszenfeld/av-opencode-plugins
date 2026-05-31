/** Read Perun's allowed bash programs from its agent markdown frontmatter (single source of truth). */
declare function readCoordinatorBashAllowlist(): string[];

export { readCoordinatorBashAllowlist };

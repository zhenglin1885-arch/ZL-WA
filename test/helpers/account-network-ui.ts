export const all = (node: any): any[] =>
  !node || typeof node !== 'object'
    ? []
    : [
        node,
        ...[node.props?.children]
          .flat(Number.POSITIVE_INFINITY)
          .flatMap(node => all(node)),
      ];

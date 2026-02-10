declare module 'colornames' {
  interface ColorEntry {
    name: string;
    value: string; // hex value
  }

  interface ColorInfo {
    value: string; // hex value
    name: string;
    vga?: boolean;
    css?: boolean;
  }

  interface ColorNames {
    (name: string): string | undefined; // Returns hex string directly
    get(name: string): ColorInfo | undefined; // Returns full color info object
    all(): ColorEntry[];
  }

  const colornames: ColorNames;
  export = colornames;
}

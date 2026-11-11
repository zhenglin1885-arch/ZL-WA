export const accountToolsFileErrorCodes = [
  'EMPTY',
  'ZERO_FILLED',
  'ENCODING',
  'JSON',
  'STRUCTURE',
  'READ',
] as const;

export interface AccountToolsFileDiagnostic {
  code: (typeof accountToolsFileErrorCodes)[number];
  bytes?: number;
  ioCode?: string;
}

interface RecoverableAccountToolsFile {
  path: string;
  backups(): { path: string; modified: number }[];
  restoreFrom(source: string): void;
}

export class AccountToolsFileError extends Error {
  constructor(
    readonly file: RecoverableAccountToolsFile,
    readonly diagnostic: AccountToolsFileDiagnostic,
  ) {
    super('账号工具配置无法读取，请保留原文件并检查 account-tools.json');
    this.name = 'AccountToolsFileError';
  }
}

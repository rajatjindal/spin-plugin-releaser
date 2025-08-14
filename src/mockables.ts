import * as fs from 'fs-extra'

// these functions are mocked during unit tests

export function readFileSync(
  filePath: string,
  encoding?: BufferEncoding
): string {
  return fs.readFileSync(filePath, encoding).toString()
}

export async function addDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

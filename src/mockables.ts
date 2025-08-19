import * as fs from 'fs-extra'

// these functions are mocked during unit tests

export function readFileSync(filePath: string, encoding?: BufferEncoding) {
  return fs.readFileSync(filePath, encoding)
}

export async function addDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

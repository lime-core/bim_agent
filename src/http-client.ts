const nativeFetch = fetch.bind(globalThis);

export function httpRequest(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  return nativeFetch(input, init);
}

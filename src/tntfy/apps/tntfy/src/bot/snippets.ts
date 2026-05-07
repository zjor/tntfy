export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SnippetInput {
  name: string;
  token: string;
  baseUrl: string;
}

export function renderTopicCreatedMessage(input: SnippetInput): string {
  const { name, token, baseUrl } = input;
  const en = htmlEscape(name);
  const et = htmlEscape(token);
  const eu = htmlEscape(baseUrl);
  return [
    `<b>Topic:</b> ${en}`,
    '',
    `<b>Token:</b> <tg-spoiler>${et}</tg-spoiler>`,
    '',
    '<b>curl:</b>',
    `<pre>curl -H "Authorization: Bearer ${et}" \\\n     -d "Hello from tntfy" \\\n     ${eu}/v1/publish/${en}</pre>`,
    '',
    '<b>Python:</b>',
    [
      '<pre>import requests',
      'requests.post(',
      `    "${eu}/v1/publish/${en}",`,
      `    headers={"Authorization": "Bearer ${et}"},`,
      '    data="Hello from tntfy",',
      ')</pre>',
    ].join('\n'),
  ].join('\n');
}

export function renderTokenRotatedMessage(input: SnippetInput): string {
  const { name, token, baseUrl } = input;
  const en = htmlEscape(name);
  const et = htmlEscape(token);
  const eu = htmlEscape(baseUrl);
  return [
    `<b>New token for</b> ${en}: <tg-spoiler>${et}</tg-spoiler>`,
    '',
    `<pre>curl -H "Authorization: Bearer ${et}" \\\n     -d "Hello from tntfy" \\\n     ${eu}/v1/publish/${en}</pre>`,
  ].join('\n');
}

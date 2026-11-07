/**
 * Route'lara durum koduyla dönen hata. message bir çeviri anahtarıdır ("errors:project.notFound");
 * hata işleyici isteğin diline çevirir. Henüz çevrilmemiş düz metin de kabul edilir.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public params?: Record<string, unknown>,
  ) {
    super(message);
  }
}

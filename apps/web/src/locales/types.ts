/** İngilizce (ve sonraki diller) Türkçe kaynakla aynı anahtarları taşımak zorunda; eksik anahtar derlemede hata verir */
export type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

/**
 * Puerto de sellado de secretos: cifra un texto para guardarlo en reposo y lo abre despues.
 * `open` lanza ante formato, clave o manipulacion incorrectos, sin revelar el motivo.
 */
export type SecretBox = {
  seal(plain: string): string;
  open(sealed: string): string;
};

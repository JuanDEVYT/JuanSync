# JuanSync

Sincroniza tus datos de Kino entre todos tus dispositivos.

## Cómo usar

1. Instala el plugin en Kino: `JuanDEVYT/JuanSync`
2. Ve a Ajustes → JuanSync → Configurar
3. Pulsa **Registrarse** — se crea tu cuenta y el token se guarda solo
4. En tu otro dispositivo, usa **Enviar configuración** o pega el mismo token

## Seguridad

- Kino cifra tus datos localmente antes de enviarlos
- El token se usa para derivar la clave de cifrado y para autenticarte con el servidor
- ⚠️ El plugin y el servidor pueden leer los datos sincronizados (Kino te lo advierte al instalar)

## Si pierdes un dispositivo

1. Regístrate de nuevo (nuevo token)
2. En Kino: **Restablecer sincronización**
3. Pasa el nuevo token a tus otros dispositivos con **Enviar configuración**

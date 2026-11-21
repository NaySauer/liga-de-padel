LIGA DE PADEL - VERSION 2: REGISTRO Y LOGIN
==========================================

REQUISITOS
- Windows 10/11
- Node.js LTS
- Visual Studio Code

INSTALACION
1. Descomprimí el ZIP.
2. Abrí la carpeta liga-padel-app-v2 en Visual Studio Code.
3. Abrí Terminal > Nueva terminal.
4. Ejecutá:
   npm install
5. Luego:
   npm start
6. Abrí http://localhost:3000

LOGIN DE ADMINISTRADOR
Usuario: admin
Contraseña inicial: CambiarAdmin123!

IMPORTANTE: esta contraseña inicial es solo para desarrollo local. Cambiala antes de usar el sistema con jugadores reales.
En Windows PowerShell, para iniciar con una contraseña propia en esa sesión:
$env:ADMIN_PASSWORD="TuClaveAdminSegura"
npm start

La contraseña inicial solo se aplica cuando se crea por primera vez el administrador. Si la base de datos ya tiene un usuario admin, cambiar la variable no cambia su contraseña. En ese caso, para esta etapa de pruebas, detené el servidor y respaldá/eliminá data/liga-padel.sqlite para crear una base nueva (esto borra los datos de prueba).

REGISTRO DE JUGADORES
- En la pantalla inicial, elegí Registrarme.
- Ingresá nombre y apellido.
- Creá una contraseña de al menos 8 caracteres y repetila.
- La cuenta se crea como PENDIENTE.
- El jugador no puede entrar a la zona de torneos hasta que admin la apruebe.

ADMINISTRADOR
- En la misma pantalla de login, ingresá usuario admin y la contraseña inicial/configurada.
- El panel permite ver jugadores pendientes, aprobados y rechazados.
- Podés aprobar o rechazar cada solicitud.
- El jugador aprobado ya puede entrar a la zona de jugador.

BASE DE DATOS
Archivo: data/liga-padel.sqlite
Las contraseñas se guardan como hashes bcrypt, no en texto plano.
No borres el archivo si querés conservar los registros.

CELULARES EN LA MISMA RED
- La PC y el celular deben estar conectados al mismo Wi-Fi.
- En Windows CMD ejecutá ipconfig.
- Buscá la Dirección IPv4 de Wi-Fi, por ejemplo 192.168.1.25.
- En el celular abrí http://192.168.1.25:3000
- Permití Node.js en el firewall de Windows para redes privadas si te lo pregunta.
- La PC debe permanecer encendida y npm start debe seguir funcionando.

ALCANCE DE ESTA ETAPA
Esta versión implementa registro, login, aprobación/rechazo y roles básicos. El panel del jugador muestra el torneo como próxima etapa. En la siguiente iteración conectaremos torneos, categorías, inscripción y elección/confirmación de pareja con usuarios reales.

SEGURIDAD Y PUBLICACION
Esta es una versión de desarrollo para probar en una red local. Antes de publicarla en Internet hay que agregar HTTPS, almacenamiento de sesiones persistente, protección CSRF/rate limit, recuperación de contraseña, cambio de contraseña del administrador, permisos por torneo/categoría y reglas de quién puede editar resultados. No uses la contraseña inicial en producción.

# NOTAS — PRUEBAS MANUALES — ETAPA 7 — FIREBASE AUTH SIMPLE

Objetivo: validar login real simple, persistencia de sesión y logout estable sin romper la Suite.

## 1) Config Firebase local del navegador
1. Abrir **Configuración > Acceso**.
2. Si la Suite sigue con placeholder, pegar la web config en el formulario local del navegador.
3. Guardar la config.
4. Confirmar que el diagnóstico cambia a **Real** y que Auth queda en estado utilizable.

## 2) Login real
1. En Firebase Console, habilitar **Authentication > Sign-in method > Email/Password**.
2. Crear o tener disponible un usuario real de prueba.
3. En **Configuración > Acceso**, escribir correo y contraseña válidos.
4. Pulsar **Iniciar sesión**.
5. Confirmar:
   - aparece **Sesión activa**,
   - se muestra el correo del usuario,
   - no se rompe el home ni la Configuración.

## 3) Persistencia
1. Recargar la Suite.
2. Confirmar que la sesión sigue activa automáticamente.
3. Verificar el strip superior de acceso en HOME.

## 4) Logout
1. Desde **Configuración > Acceso** o desde el strip superior, pulsar **Salir / Cerrar sesión**.
2. Confirmar:
   - el estado vuelve a **Sin sesión**,
   - el usuario desaparece del resumen,
   - no hay errores visuales ni la app queda trabada.

## 5) Errores comunes
1. Probar contraseña incorrecta.
2. Probar correo mal formado.
3. Probar dominio no autorizado o provider sin habilitar.
4. Confirmar que el mensaje es claro y no deja al usuario perdido.

## Resultado esperado
- Login real operativo.
- Persistencia estable en el navegador.
- Logout estable.
- Mensajería clara ante errores.
- Suite A33 sigue estable en desktop, iPad y PWA.

# 🚫 Bloqueador de Anuncios para YouTube

> Extensión de Chrome moderna y eficiente que bloquea todos los anuncios de YouTube usando Manifest V3

[![Versión](https://img.shields.io/badge/versión-1.0.0-blue.svg)](https://github.com/tu-usuario/youtube-adblocker)
[![Licencia](https://img.shields.io/badge/licencia-MIT-green.svg)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-yellow.svg)](https://developer.chrome.com/docs/extensions/mv3/)

## 📋 Características Principales

- ✅ **Bloqueo Total**: Pre-roll, mid-roll, post-roll, banners y overlays
- ⚡ **Alto Rendimiento**: Sin impacto en la velocidad de navegación
- 🎯 **Auto-Skip**: Salta anuncios automáticamente cuando es posible
- 📊 **Estadísticas**: Contador de anuncios bloqueados en tiempo real
- 🔒 **Privacidad**: Sin recopilación de datos, todo funciona localmente
- 🎨 **Interfaz Moderna**: Popup intuitivo y fácil de usar
- ⚙️ **Personalizable**: Lista blanca para canales favoritos
- 🛡️ **Modo Stealth**: Evita detección de anti-adblock
- 🔗 **Bypass Alternativo**: Acceso rápido a `yout-ube.com` para videos sin anuncios

## 🚀 Instalación Rápida

### Opción 1: Modo Desarrollador

1. Descarga o clona este repositorio
2. Abre Chrome y ve a `chrome://extensions/`
3. Activa el "Modo de desarrollador" (esquina superior derecha)
4. Haz clic en "Cargar extensión sin empaquetar"
5. Selecciona la carpeta del proyecto
6. ¡Listo! El ícono aparecerá en tu barra de herramientas

### Opción 2: Chrome Web Store (Próximamente)

La extensión estará disponible en Chrome Web Store próximamente.

## 📁 Estructura del Proyecto

```
youtube-adblocker/
│
├── manifest.json              # Configuración principal (Manifest V3)
├── README.md                  # Este archivo
├── LICENSE                    # Licencia MIT
│
├── icons/                     # Iconos de la extensión
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── popup/                     # Interfaz de usuario
│   ├── popup.html            # Estructura HTML del popup
│   ├── popup.css             # Estilos (incluido en HTML)
│   └── popup.js              # Lógica del popup (incluido en HTML)
│
├── scripts/                   # Scripts principales
│   ├── background.js         # Service Worker
│   ├── content.js            # Content script
│   └── blocker.js            # Lógica de bloqueo
│
└── config/                    # Configuración
    └── rules.json            # Reglas de bloqueo de red
```

## 🎯 Cómo Funciona

### 1. Bloqueo a Nivel de Red
Utiliza la API `declarativeNetRequest` de Chrome para bloquear solicitudes a servidores de anuncios antes de que se descarguen.

### 2. Manipulación del DOM
Los content scripts detectan y ocultan elementos publicitarios directamente en la página.

### 3. Auto-Skip Inteligente
Detecta cuando hay anuncios en video y los salta automáticamente o acelera su reproducción.

### 4. Observador de Mutaciones
Monitorea cambios en el DOM para detectar anuncios que se cargan dinámicamente.

## ⚙️ Configuración

### Activar/Desactivar

Haz clic en el ícono de la extensión y usa el interruptor para activar o desactivar el bloqueador.

### Lista Blanca de Canales

Para apoyar a tus creadores favoritos, puedes añadirlos a la lista blanca:

1. Visita el canal en YouTube
2. Copia el ID del canal de la URL
3. Añádelo en la configuración de la extensión

### Ajustar Agresividad

Puedes modificar el nivel de bloqueo editando `scripts/blocker.js`:

```javascript
const CONFIG = {
    aggressiveness: 'high',  // 'low', 'medium', 'high'
    skipDelay: 0,           // Delay antes de saltar (ms)
    hideElements: true      // Ocultar elementos publicitarios
};
```

## 🔧 Personalización

### Añadir Nuevos Filtros

Edita `config/rules.json` para añadir nuevas reglas de bloqueo:

```json
{
  "id": 11,
  "priority": 1,
  "action": { "type": "block" },
  "condition": {
    "urlFilter": "*://tu-dominio-a-bloquear.com/*",
    "resourceTypes": ["script"]
  }
}
```

### Modificar Selectores CSS

En `scripts/blocker.js`, añade nuevos selectores al array `AD_SELECTORS`:

```javascript
const AD_SELECTORS = [
  '.video-ads',
  '.tu-nuevo-selector',
  // ... más selectores
];
```

## 🐛 Solución de Problemas

### Los anuncios siguen apareciendo

1. Recarga la extensión en `chrome://extensions/`
2. Limpia la caché del navegador
3. Asegúrate de que la extensión tiene todos los permisos necesarios
4. Verifica que esté activada en el popup

### YouTube detecta el bloqueador

1. Desactiva otras extensiones de bloqueo de anuncios
2. Limpia cookies y datos de YouTube
3. Actualiza la extensión a la última versión

### La extensión ralentiza el navegador

1. Reduce la frecuencia de verificación en `content.js`
2. Desactiva funciones no esenciales
3. Reporta el problema para optimizaciones

## 📊 Estadísticas

La extensión rastrea:
- **Anuncios bloqueados hoy**: Contador diario
- **Total de anuncios bloqueados**: Contador histórico
- **Tiempo ahorrado**: Estimación del tiempo ahorrado

Todas las estadísticas se guardan localmente y no se comparten.

## 🔒 Privacidad y Seguridad

- ✅ **Sin tracking**: No recopilamos ningún dato de navegación
- ✅ **Sin analíticas**: No enviamos información a servidores externos
- ✅ **Permisos mínimos**: Solo los necesarios para funcionar
- ✅ **Código abierto**: Puedes auditar todo el código
- ✅ **Local-first**: Todo funciona en tu navegador

## 🤝 Contribuir

¡Las contribuciones son bienvenidas!

1. Fork el proyecto
2. Crea una rama: `git checkout -b feature/nueva-caracteristica`
3. Commit tus cambios: `git commit -m 'Añade nueva característica'`
4. Push a la rama: `git push origin feature/nueva-caracteristica`
5. Abre un Pull Request

### Guías de Contribución

- Sigue el estilo de código existente
- Comenta tu código adecuadamente
- Actualiza la documentación si es necesario
- Prueba tus cambios exhaustivamente

## 📝 Changelog

### v1.0.0 (2025-11-11)
- 🎉 Lanzamiento inicial
- ✅ Bloqueo de todos los tipos de anuncios de YouTube
- ✅ Interfaz popup moderna
- ✅ Sistema de estadísticas
- ✅ Soporte para Manifest V3

## 🎓 Recursos

- [Documentación de Chrome Extensions](https://developer.chrome.com/docs/extensions/)
- [Guía de Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate)
- [API declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/)
- [Content Scripts](https://developer.chrome.com/docs/extensions/mv3/content_scripts/)

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo [LICENSE](LICENSE) para más detalles.

## 👨‍💻 Autor

**Tu Nombre**
- GitHub: [@tu-usuario](https://github.com/tu-usuario)
- Email: tu-email@example.com

## 🙏 Agradecimientos

- Comunidad de desarrolladores de Chrome Extensions
- Usuarios beta testers
- Contribuidores del proyecto

## ⚠️ Disclaimer

Esta extensión es solo para fines educativos. El uso de bloqueadores de anuncios puede afectar a los creadores de contenido que dependen de los ingresos publicitarios. Considera apoyar a tus creadores favoritos a través de otros medios como:

- YouTube Premium
- Membresías de canal
- Patreon o plataformas similares
- Compra de merchandising

---

**¿Te gusta este proyecto?** ⭐ Dale una estrella en GitHub

**¿Encontraste un bug?** 🐛 [Reporta un issue](https://github.com/tu-usuario/youtube-adblocker/issues)

**¿Tienes una sugerencia?** 💡 [Abre una discusión](https://github.com/tu-usuario/youtube-adblocker/discussions)

---

Hecho con ❤️ para una mejor experiencia en YouTube
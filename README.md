# Ethical Web Scraper Job - AWS Fargate

Scheduled web scraping job que se ejecuta cada 3 horas en AWS Fargate con prácticas éticas.

## 📁 Estructura del Proyecto

```
proyectocej/
├── src/
│   ├── config.js           # Configuración centralizada
│   ├── logger.js           # Sistema de logging
│   ├── ethicalScraper.js   # Clase principal
│   ├── scraper.js          # Lógica de scraping
│   ├── formFiller.js       # Llenado de formularios
│   ├── robotsChecker.js    # Verificación de robots.txt
│   ├── resultSaver.js      # Guardado de resultados
│   └── utils/
│       └── index.js        # Utilidades generales
├── index.js                # Punto de entrada
├── run-local.js            # Script para testing local
├── test-forms.js           # Testing específico de formularios
├── package.json            # Dependencias
├── Dockerfile              # Configuración del contenedor
├── aws-fargate.yml         # Infraestructura AWS
└── deploy.sh               # Script de deployment
```

## 🌟 Características

- ✅ **Código Modular**: Separado en módulos especializados
- ✅ **Configuración Flexible**: Variables de entorno centralizadas
- ✅ **Scheduled Job**: Se ejecuta automáticamente cada 3 horas
- ✅ **Scraping Ético**: Respeta robots.txt y implementa delays
- ✅ **Form Filling**: Llena formularios automáticamente
- ✅ **AWS Fargate**: Serverless, escalable y sin gestión de servidores
- ✅ **CloudWatch Logs**: Logging estructurado y monitoreo
- ✅ **S3 Storage**: Opcional para almacenar resultados

## 🚀 Configuración Rápida

### Variables de Entorno

```bash
# REQUERIDO
export TARGET_URLS="https://example.com,https://quotes.toscrape.com"

# Configuración del navegador
export HEADLESS=false              # true/false - Browser visible o no
export SLOW_MO=1000               # Velocidad de acciones (ms)
export DEVTOOLS=true              # Abrir DevTools

# Configuración de formularios
export INPUT_VALUE="151151"       # Valor a ingresar en inputs
export FORM_WAIT_TIME=10000      # Tiempo de espera para ver resultado
export TYPE_DELAY=100            # Delay entre teclas al escribir

# Configuración general
export LOG_LEVEL=info            # debug, info, error
export DELAY_MS=3000            # Delay entre requests
export TIMEOUT_MS=30000         # Timeout de requests
export RESPECT_ROBOTS=true      # Respetar robots.txt
```

### Ejecución Local (Solo Scraping - Sin AWS)

```bash
# Setup inicial
npm run setup

# Scraping puro (usa configuración del .env)
npm run scrape

# Testing con URLs específicas
node run-local.js https://casillas.pj.gob.pe/sinoe/login.xhtml

# Testing específico de formularios (navegador visible)
node test-forms.js https://casillas.pj.gob.pe/sinoe/login.xhtml

# Scraping puro sin AWS/S3
node scrape-only.js

# Con configuración personalizada (sobreescribe .env)
HEADLESS=false LOG_LEVEL=debug node run-local.js https://tu-sitio.com
```

## 🔧 Módulos Principales

### 1. **Config** (`src/config.js`)
Configuración centralizada de toda la aplicación:
- Configuración del navegador (headless, slowMo, devtools)
- Selectores de formularios
- Timeouts y delays
- Variables de entorno

### 2. **Logger** (`src/logger.js`)
Sistema de logging estructurado:
```javascript
logger.info('Mensaje informativo', { data: 'opcional' });
logger.debug('Mensaje de debug', { details: {...} });
logger.error('Error ocurrido', { error: error.message });
```

### 3. **FormFiller** (`src/formFiller.js`)
Llenado inteligente de formularios:
- Busca inputs por placeholder, name, id
- Múltiples estrategias de búsqueda
- Limpieza y llenado seguro de campos
- Análisis completo de todos los inputs

### 4. **WebScraper** (`src/scraper.js`)
Lógica principal de scraping:
- Navegación ética
- Verificación de robots.txt
- Extracción de datos y metadata
- Manejo de errores robusto

### 5. **RobotsChecker** (`src/robotsChecker.js`)
Verificación de robots.txt:
- Parsing básico de directivas
- Respeto automático a restricciones
- Fallback si no se puede verificar

## 🎯 Uso para Formularios

### Configuración Específica para Llenado
```bash
# Para el ejemplo de SINOE
export TARGET_URLS="https://casillas.pj.gob.pe/sinoe/login.xhtml"
export INPUT_VALUE="151151"
export HEADLESS=false              # Ver el navegador
export LOG_LEVEL=debug             # Ver logs detallados
export FORM_WAIT_TIME=30000        # 30 segundos para inspeccionar
export SLOW_MO=1000               # Slow motion para ver acciones
```

### Selectores Configurables
En `src/config.js` puedes modificar los selectores:
```javascript
selectors: {
  userByPlaceholder: 'input[placeholder="Usuario"]',
  userByName: 'input[name="P5qKey@kVBiG2Yn2dPEwG3&@n"]',
  textInputs: 'input[type="text"]',
  commonSelectors: [
    'input[id*="user"]',
    'input[id*="login"]',
    'input[class*="user"]'
  ]
}
```

## 📊 Output de Logs

### Logs de Formularios
```json
{"level":"info","message":"Found 3 total inputs on page"}
{"level":"info","message":"Input 1: {type: 'text', placeholder: 'Usuario', name: 'P5qKey@kVBiG2Yn2dPEwG3&@n'}"}
{"level":"info","message":"Found input with placeholder 'Usuario', filling with 151151"}
{"level":"debug","message":"Waiting 30000ms to see the filled inputs..."}
```

### Logs de Resultados
```json
{"level":"info","message":"Job completed","data":{"totalUrls":1,"successfulScrapes":1,"results":[...]}}
```

## 🚀 Deployment a AWS

El deployment sigue igual que antes:

```bash
export TARGET_URLS="https://casillas.pj.gob.pe/sinoe/login.xhtml"
export SCHEDULE_EXPRESSION="rate(3 hours)"
./deploy.sh
```

## 🛠️ Personalización

### Agregar Nuevos Selectores
En `src/formFiller.js`:
```javascript
async fillCustomInputs(page) {
  // Tu lógica personalizada aquí
  const customInput = await page.$('#mi-selector-especifico');
  if (customInput) {
    await this.fillInput(page, customInput);
  }
}
```

### Modificar Comportamiento del Navegador
En `src/config.js`:
```javascript
browser: {
  headless: false,
  slowMo: 2000,      // Más lento para debug
  devtools: true,
  args: [
    // Agregar más argumentos de Chrome
    '--disable-web-security'
  ]
}
```

## 💰 Costos Estimados AWS

Para un job cada 3 horas: **~$0.90/mes**

## 📞 Troubleshooting

### Problemas Comunes
1. **No encuentra inputs**: Revisar selectores en `src/config.js`
2. **Navegador no abre**: Verificar `HEADLESS=false`
3. **Error de módulos**: Ejecutar `npm install`

### Debugging
```bash
LOG_LEVEL=debug HEADLESS=false node run-local.js https://tu-sitio.com
```

---

**Estructura mejorada** ✅ Código más limpio y mantenible!
# Ethical Web Scraping Guidelines

Este proyecto implementa un sistema de web scraping ético diseñado para ser respetuoso con los servidores web y cumplir con las mejores prácticas de la industria.

## 🌟 Características Éticas Implementadas

### 1. **Respeto a robots.txt**
- ✅ Verificación automática de robots.txt antes de realizar scraping
- ✅ Parseo básico de directivas User-agent y Disallow
- ✅ Respeto automático a las restricciones encontradas

### 2. **User-Agent Identificativo**
```
EthicalBot/1.0 (Contact: your-email@domain.com)
```
- ✅ User-Agent claro y identificable
- ✅ Información de contacto incluida
- ✅ Versión del bot especificada

### 3. **Rate Limiting Inteligente**
- ✅ Límite de 10 requests por minuto por IP
- ✅ Delay de 2 segundos entre requests
- ✅ Máximo 2 páginas concurrentes por instancia

### 4. **Optimización de Recursos**
- ✅ Bloqueo de recursos innecesarios (imágenes, CSS, fuentes)
- ✅ Timeout configurado para evitar conexiones colgadas
- ✅ Uso eficiente de memoria y CPU

### 5. **Respeto al Servidor**
- ✅ Headers HTTP apropiados
- ✅ Manejo de errores HTTP
- ✅ Verificación de estado de respuesta

## 🚀 Uso del API

### Health Check
```bash
GET /health
```

### Scraping Endpoint
```bash
POST /scrape
Content-Type: application/json

{
  "url": "https://example.com",
  "selector": "h1"  # Opcional, por defecto "body"
}
```

### Ejemplo con curl
```bash
curl -X POST http://your-service-url/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "selector": "h1"}'
```

## 🔧 Configuración Ética

### Variables de Entorno
```bash
# Opcional: Personalizar configuración
SCRAPING_DELAY=2000          # Delay entre requests (ms)
MAX_CONCURRENT_PAGES=2       # Páginas concurrentes máximas
REQUEST_TIMEOUT=30000        # Timeout de request (ms)
```

### Rate Limiting
El sistema implementa rate limiting basado en IP:
- **Límite**: 10 requests por minuto
- **Respuesta**: HTTP 429 con tiempo de espera
- **Reinicio**: Automático cada minuto

## 🛡️ Medidas de Seguridad

### Container Security
- ✅ Usuario no-root en el contenedor
- ✅ Imagen base Alpine (minimal)
- ✅ Health checks configurados
- ✅ Resource limits en Fargate

### Network Security
- ✅ Security Groups restrictivos
- ✅ VPC privada recomendada
- ✅ Load Balancer como único punto de entrada

## 📋 Buenas Prácticas Recomendadas

### Para Administradores
1. **Monitoreo**: Configurar CloudWatch alarms
2. **Logs**: Revisar logs regularmente para patrones sospechosos
3. **Scaling**: Ajustar auto-scaling según necesidades
4. **Updates**: Mantener dependencias actualizadas

### Para Usuarios
1. **Frequency**: No hacer requests excesivos
2. **Targets**: Solo hacer scraping de sitios públicos
3. **Data**: No extraer datos personales o sensibles
4. **Compliance**: Verificar términos de servicio del sitio

## 🚨 Restricciones y Limitaciones

### Lo que NO hace este scraper:
- ❌ No ignora robots.txt
- ❌ No hace requests masivos sin delays
- ❌ No usa User-Agents falsos o engañosos
- ❌ No intenta evadir rate limits
- ❌ No hace scraping de contenido protegido por login

### Sitios Problemáticos:
- ❌ Sitios con CAPTCHA obligatorio
- ❌ Sitios que requieren JavaScript complejo
- ❌ Sitios con anti-bot avanzado
- ❌ Contenido detrás de paywall

## 📊 Monitoreo y Logs

### Logs Importantes
```bash
# Ver logs en AWS CloudWatch
aws logs tail /ecs/ethical-scraper --follow

# Métricas importantes:
- Request count per minute
- Error rate
- Response times
- Robots.txt violations (should be 0)
```

### CloudWatch Metrics
- **CPUUtilization**: Debe estar < 70%
- **MemoryUtilization**: Debe estar < 80%
- **RequestCount**: Monitor para patrones anormales
- **TargetResponseTime**: Debe estar < 5s

## 🔄 Mantenimiento

### Updates Regulares
```bash
# Rebuild y redeploy
./deploy.sh

# Verificar salud del servicio
curl http://your-service-url/health
```

### Backup y Recovery
- Configuración almacenada en CloudFormation
- Imágenes versionadas en ECR
- Logs persistidos en CloudWatch

## 📞 Soporte

Si encuentras problemas o necesitas ajustar la configuración ética, verifica:

1. **Logs de aplicación** en CloudWatch
2. **Métricas de rate limiting** 
3. **Respuestas HTTP** del sitio objetivo
4. **Configuración de robots.txt** del sitio

---

**Recuerda**: El scraping ético es responsabilidad de todos. Usa esta herramienta de manera responsable y siempre respeta los términos de servicio de los sitios web.
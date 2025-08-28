# 🪟 SINOE Web Scraper - Windows Deployment Guide

🚀 **Versión simplificada y económica** para Windows con una sola instancia Spot y sin Secrets Manager.

## 💰 Costo Estimado: $5-13/mes

- **ECS Fargate Spot**: $3-5/mes (60-70% descuento)
- **DynamoDB**: $1-5/mes (pay-per-request)
- **S3 Storage**: $0.50-2/mes
- **CloudWatch**: $0.50-1/mes
- **ECR**: $0.10/mes

## 📋 Requisitos Previos

### 1. **AWS CLI** instalado y configurado
```cmd
REM Descargar desde: https://aws.amazon.com/cli/
aws configure
aws sts get-caller-identity
```

### 2. **Docker Desktop** instalado y funcionando
```cmd
REM Descargar desde: https://www.docker.com/products/docker-desktop
docker --version
```

### 3. **Credenciales requeridas**
- Usuario y contraseña de SINOE
- API key de OpenAI para resolver CAPTCHAs

## 🚀 Deployment Rápido (3 pasos)

### **Paso 1: Configurar variables de entorno**
```cmd
REM Ejecutar el script de configuración
setup-env.bat

REM O configurar manualmente:
set SINOE_USERNAME=tu-usuario
set SINOE_PASSWORD=tu-contraseña
set OPENAI_API_KEY=sk-tu-api-key
```

### **Paso 2: Cargar variables (en cada nueva ventana CMD)**
```cmd
sinoe-env.bat
```

### **Paso 3: Desplegar**
```cmd
deploy-simple.bat
```

¡Eso es todo! El sistema se desplegará automáticamente en AWS.

## 📁 Archivos del Proyecto

| Archivo | Descripción |
|---------|-------------|
| `setup-env.bat` | Configuración interactiva de variables |
| `sinoe-env.bat` | Variables de entorno (generado automáticamente) |
| `deploy-simple.bat` | Script principal de deployment |
| `cloudformation-simple.yaml` | Template de infraestructura AWS |
| `sinoe-commands.bat` | Comandos de gestión (generado automáticamente) |

## 🔧 Configuración Detallada

### Variables de Entorno Requeridas
```cmd
set SINOE_USERNAME=tu-usuario-sinoe
set SINOE_PASSWORD=tu-contraseña-sinoe
set OPENAI_API_KEY=sk-tu-openai-api-key
```

### Variables Opcionales (con valores por defecto)
```cmd
set WHATSAPP_PHONE=51913052298
set EMAIL_ADDRESS=franco.caralv@gmail.com
set PROJECT_NAME=sinoe-scraper
set AWS_REGION=us-east-1
set SCHEDULE_EXPRESSION=rate(3 hours)
```

## 📊 Monitoreo y Gestión

### Ver logs en tiempo real
```cmd
aws logs tail /ecs/sinoe-scraper --follow --region us-east-1
```

### Ejecutar manualmente
```cmd
REM El comando completo se genera automáticamente en sinoe-commands.bat
aws ecs run-task --cluster sinoe-scraper-cluster ...
```

### Consultar datos guardados
```cmd
aws dynamodb scan --table-name DocumentosSinoe --region us-east-1
```

### Controlar la programación
```cmd
REM Pausar ejecuciones automáticas
aws events disable-rule --name sinoe-scraper-schedule --region us-east-1

REM Reanudar ejecuciones automáticas  
aws events enable-rule --name sinoe-scraper-schedule --region us-east-1
```

## 🏗️ Infraestructura Creada

### AWS Resources
- **ECS Cluster**: `sinoe-scraper-cluster` (solo Spot instances)
- **DynamoDB Table**: `DocumentosSinoe` 
- **S3 Bucket**: Para sesiones de WhatsApp
- **ECR Repository**: Para imágenes Docker
- **CloudWatch**: Logs y dashboard
- **EventBridge**: Programación automática
- **IAM Roles**: Permisos mínimos necesarios

### Tabla DynamoDB: DocumentosSinoe
- **Partition Key**: `numeroExpediente` (String)
- **Sort Key**: `numeroNotificacion` (String)
- **Billing**: Pay-per-request (costo por uso)

## 📱 Funcionalidades

### ✅ Incluido en versión simplificada
- ✅ Web scraping automatizado cada 3 horas
- ✅ Resolución automática de CAPTCHAs con OpenAI
- ✅ Notificaciones WhatsApp multi-usuario
- ✅ Fallback a email si WhatsApp falla
- ✅ Almacenamiento persistente en DynamoDB
- ✅ Sesiones WhatsApp guardadas en S3
- ✅ Monitoring con CloudWatch
- ✅ Instancias Spot (60-70% descuento)

### ❌ Removido para reducir costos
- ❌ Secrets Manager (credenciales en variables de entorno)
- ❌ Point-in-time recovery DynamoDB
- ❌ Múltiples instancias/redundancia
- ❌ Retención extendida de logs (14 días vs 30)

## 🔍 Troubleshooting Windows

### Error: "aws no se reconoce como comando"
```cmd
REM AWS CLI no instalado o no en PATH
REM Descargar desde: https://aws.amazon.com/cli/
REM Reiniciar CMD después de instalar
```

### Error: "docker no se reconoce como comando"
```cmd
REM Docker Desktop no instalado o no funcionando
REM Descargar desde: https://www.docker.com/products/docker-desktop
REM Asegurarse que Docker Desktop esté ejecutándose
```

### Error: "Unable to locate credentials"
```cmd
REM AWS no configurado
aws configure
REM Ingresар Access Key ID, Secret Access Key, y Region
```

### Error: "No default VPC found"
```cmd
REM Configurar VPC manualmente
set VPC_ID=vpc-tu-vpc-id
set SUBNET_IDS=subnet-xxx,subnet-yyy
```

### Variables de entorno no persisten
```cmd
REM Ejecutar sinoe-env.bat en cada nueva ventana CMD
sinoe-env.bat

REM O configurar variables del sistema en Windows:
REM Panel de Control > Sistema > Variables de entorno
```

## 📈 Monitoreo de Costos

### CloudWatch Dashboard
El deployment crea automáticamente un dashboard con:
- Actividad de DynamoDB
- Logs recientes del scraper
- URL: Se muestra al final del deployment

### Facturas AWS
- **Billing Dashboard**: https://console.aws.amazon.com/billing/
- **Cost Explorer**: Para análisis detallado de costos
- **Budget Alerts**: Configurar alertas si supera $15/mes

## 🔐 Seguridad

### Credenciales
- Almacenadas como variables de entorno (no Secrets Manager)
- **IMPORTANTE**: No committear `sinoe-env.bat` a Git
- Usar `.gitignore` para excluir archivos con credenciales

### IAM Permissions
- Roles con permisos mínimos necesarios
- Solo acceso a recursos del proyecto
- Sin permisos administrativos

### Network Security
- Security Groups restrictivos
- Solo tráfico outbound permitido
- Sin puertos de entrada abiertos

## 🔄 Actualizaciones

### Actualizar código del scraper
```cmd
REM Solo ejecutar deployment de nuevo
deploy-simple.bat
```

### Cambiar configuración
```cmd
REM Ejecutar setup de nuevo
setup-env.bat

REM Luego re-deployar
deploy-simple.bat
```

### Cambiar schedule
```cmd
REM Modificar variable y re-deployar
set SCHEDULE_EXPRESSION=rate(1 hour)
deploy-simple.bat
```

## 🆘 Soporte

### Logs del Deployment
- Los errores se muestran en la consola
- Revisar CloudFormation en AWS Console si falla

### Logs del Scraper
```cmd
aws logs tail /ecs/sinoe-scraper --follow --region us-east-1
```

### Estado de la Infraestructura
```cmd
REM Estado del stack
aws cloudformation describe-stacks --stack-name sinoe-scraper-simple --region us-east-1

REM Estado de ECS
aws ecs list-tasks --cluster sinoe-scraper-cluster --region us-east-1
```

---

## 🎯 Resumen para Windows

```cmd
REM 1. Configurar (solo una vez)
setup-env.bat

REM 2. Cargar variables (en cada CMD nueva)  
sinoe-env.bat

REM 3. Desplegar
deploy-simple.bat

REM 4. Monitorear
aws logs tail /ecs/sinoe-scraper --follow
```

**¡Ya tienes tu scraper SINOE funcionando 24/7 por menos de $15/mes!** 🚀
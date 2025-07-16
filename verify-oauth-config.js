// verify-oauth-config.js - Script para verificar configuración OAuth
require('dotenv').config();

console.log('🔍 VERIFICACIÓN DE CONFIGURACIÓN OAUTH');
console.log('=====================================\n');

// Variables críticas para OAuth
const criticalVars = [
    'MicrosoftAppId',
    'MicrosoftAppPassword',
    'connectionName',
    'OAUTH_CONNECTION_NAME'
];

// Variables opcionales pero importantes
const optionalVars = [
    'MicrosoftAppType',
    'MicrosoftAppTenantId',
    'OAUTH_APP_ID',
    'OAUTH_APP_PASSWORD'
];

console.log('📋 VARIABLES CRÍTICAS:');
console.log('---------------------');
criticalVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
        console.log(`✅ ${varName}: ${value.substring(0, 10)}...`);
    } else {
        console.log(`❌ ${varName}: NO CONFIGURADA`);
    }
});

console.log('\n📋 VARIABLES OPCIONALES:');
console.log('-----------------------');
optionalVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
        console.log(`✅ ${varName}: ${value.substring(0, 10)}...`);
    } else {
        console.log(`⚠️  ${varName}: No configurada`);
    }
});

// Determinar qué connectionName se usará
const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
console.log('\n🔗 CONNECTION NAME EFECTIVO:');
console.log('---------------------------');
console.log(`Valor: ${connectionName || 'NO CONFIGURADO'}`);
console.log(`Fuente: ${process.env.connectionName ? 'connectionName' : process.env.OAUTH_CONNECTION_NAME ? 'OAUTH_CONNECTION_NAME' : 'NINGUNA'}`);

// Verificar URLs de API
console.log('\n🌐 URLs DE API:');
console.log('---------------');
const apiUrls = {
    'SIRH API': 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/empleado',
    'TOKEN_SIRH': process.env.TOKEN_SIRH ? '✅ Configurado' : '❌ No configurado',
    'TOKEN_BUBBLE': process.env.TOKEN_BUBBLE ? '✅ Configurado' : '❌ No configurado'
};

for (const [key, value] of Object.entries(apiUrls)) {
    console.log(`${key}: ${value}`);
}

// Recomendaciones
console.log('\n💡 RECOMENDACIONES PARA STAGING:');
console.log('--------------------------------');

if (!connectionName) {
    console.log('❗ CRÍTICO: No hay connectionName configurado. El bot no podrá autenticar usuarios.');
    console.log('   Solución: Configura connectionName o OAUTH_CONNECTION_NAME en las variables de entorno de Render.');
}

if (!process.env.MicrosoftAppId || !process.env.MicrosoftAppPassword) {
    console.log('❗ CRÍTICO: MicrosoftAppId o MicrosoftAppPassword no están configurados.');
    console.log('   Solución: Estas variables son esenciales para el funcionamiento del bot.');
}

console.log('\n📝 CHECKLIST PARA STAGING:');
console.log('-------------------------');
console.log('1. ¿El connectionName en staging apunta a la configuración OAuth correcta en Azure?');
console.log('2. ¿El App Registration en Azure está configurado para el ambiente de staging?');
console.log('3. ¿Los redirect URIs en Azure incluyen la URL de staging?');
console.log('4. ¿El bot de staging está registrado en el Bot Framework con las credenciales correctas?');
console.log('5. ¿El manifest de Teams apunta a la URL correcta de staging?');

console.log('\n🔧 PASOS PARA DIAGNOSTICAR:');
console.log('---------------------------');
console.log('1. Verifica en Azure Portal -> Bot Services -> tu-bot-staging -> Configuration -> OAuth Connection Settings');
console.log('2. El "Name" en OAuth Connection Settings debe coincidir con connectionName');
console.log('3. Prueba la conexión con el botón "Test Connection" en Azure');
console.log('4. Verifica que el Service Provider sea el correcto (usualmente "Azure Active Directory v2")');

console.log('\n✅ Script completado');
// debug-token.js - Script para debugging de token OAuth
const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function testToken(token) {
    console.log('\n🔍 Iniciando test de token...');
    console.log(`📊 Token length: ${token.length}`);
    console.log(`📊 Token preview: ${token.substring(0, 40)}...`);
    
    // Verificar formato del token
    if (token.startsWith('Bearer ')) {
        console.log('⚠️  Token ya incluye prefix "Bearer"');
        token = token.substring(7); // Remover "Bearer " si ya lo tiene
    }
    
    const authHeader = `Bearer ${token}`;
    console.log(`\n🔑 Authorization header: ${authHeader.substring(0, 50)}...`);
    
    const config = {
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Alfa-Teams-Bot/1.0'
        },
        timeout: 10000,
        validateStatus: (status) => true // Aceptar todos los status codes
    };
    
    console.log('\n📡 Enviando petición a SIRH API...');
    console.log('URL: https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/empleado');
    console.log('Headers:', JSON.stringify(config.headers, null, 2));
    
    try {
        const response = await axios.get(
            'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/empleado',
            config
        );
        
        console.log(`\n✅ Respuesta recibida - Status: ${response.status} ${response.statusText}`);
        console.log('Response Headers:', JSON.stringify(response.headers, null, 2));
        
        if (response.status === 200) {
            console.log('\n🎉 Token válido! Datos del empleado:');
            console.log(JSON.stringify(response.data, null, 2));
        } else if (response.status === 401) {
            console.log('\n❌ Error 401 - Token inválido o expirado');
            console.log('Response data:', JSON.stringify(response.data, null, 2));
        } else {
            console.log(`\n⚠️  Status inesperado: ${response.status}`);
            console.log('Response data:', JSON.stringify(response.data, null, 2));
        }
        
    } catch (error) {
        console.error('\n🚨 Error en la petición:', error.message);
        
        if (error.response) {
            console.log(`Status: ${error.response.status}`);
            console.log('Headers:', JSON.stringify(error.response.headers, null, 2));
            console.log('Data:', JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            console.log('No se recibió respuesta del servidor');
            console.log('Request config:', JSON.stringify(error.config, null, 2));
        }
    }
}

async function compareWithPostman() {
    console.log('\n📋 INSTRUCCIONES PARA COMPARAR CON POSTMAN:');
    console.log('1. En Postman, ve a la pestaña "Headers" de tu request exitoso');
    console.log('2. Busca el header "Authorization"');
    console.log('3. Copia el valor completo (incluyendo "Bearer " si lo tiene)');
    console.log('4. Pega el token aquí para comparar\n');
    
    rl.question('Token de Postman: ', async (postmanToken) => {
        if (!postmanToken) {
            console.log('No se ingresó token');
            rl.close();
            return;
        }
        
        console.log('\n=== TEST CON TOKEN DE POSTMAN ===');
        await testToken(postmanToken.trim());
        
        rl.question('\n¿Quieres probar con el token del bot? (s/n): ', async (answer) => {
            if (answer.toLowerCase() === 's') {
                rl.question('Token del bot: ', async (botToken) => {
                    if (botToken) {
                        console.log('\n=== TEST CON TOKEN DEL BOT ===');
                        await testToken(botToken.trim());
                    }
                    rl.close();
                });
            } else {
                rl.close();
            }
        });
    });
}

// Menú principal
console.log('🔧 DEBUG DE TOKEN OAUTH - ALFA BOT');
console.log('==================================\n');
console.log('1. Probar token específico');
console.log('2. Comparar con Postman');
console.log('3. Salir\n');

rl.question('Selecciona una opción (1-3): ', async (option) => {
    switch(option) {
        case '1':
            rl.question('\nIngresa el token: ', async (token) => {
                if (token) {
                    await testToken(token.trim());
                }
                rl.close();
            });
            break;
            
        case '2':
            await compareWithPostman();
            break;
            
        case '3':
            rl.close();
            break;
            
        default:
            console.log('Opción inválida');
            rl.close();
    }
});

rl.on('close', () => {
    console.log('\n👋 Fin del debug');
    process.exit(0);
});
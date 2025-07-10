# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- `npm run start` - Start the production server
- `npm run dev` - Start development server with nodemon
- `npm run build` - Build the application using esbuild
- `npm run test` - Run Jest tests
- `npm run lint` - Run ESLint

### Key Environment Variables
The application requires these environment variables:

**Required:**
- `MicrosoftAppId` - Microsoft Bot Framework App ID
- `MicrosoftAppPassword` - Microsoft Bot Framework App Password
- `connectionName` - OAuth connection name for authentication

**Optional (with fallbacks):**
- `OPENAI_API_KEY` - OpenAI API key for AI functionality
- `COSMOSDB_ENDPOINT` - CosmosDB endpoint URL
- `COSMOSDB_KEY` - CosmosDB access key
- `COSMOSDB_DATABASE_ID` - Database ID (defaults to 'alfabot')
- `COSMOSDB_CONVERSATIONS_CONTAINER` - Container ID (defaults to 'conversations')

**Azure Search (for document search):**
- `SERVICE_ENDPOINT` - Azure Search service endpoint
- `API_KEY` - Azure Search API key
- `INDEX_NAME` - Search index name (defaults to 'alfa_bot')

**External API Integration:**
- `TOKEN_SIRH` - Token for SIRH vacation API (REQUIRED for vacation requests)
- `TOKEN_BUBBLE` - Token for Bubble apps (employee directory, cafeteria menu)

**Alternative OAuth (optional):**
- `OAUTH_CONNECTION_NAME` - Alternative OAuth connection name

## Architecture Overview

### Bot Framework Structure
This is a Microsoft Teams bot built with the Bot Framework SDK. The main components are:

1. **Server (index.js)** - BotServer class that handles Express server setup, Bot Framework adapter configuration, and graceful shutdown
2. **DialogBot (bots/dialogBot.js)** - Base class for handling dialog flows with robust error handling and state management
3. **TeamsBot (bots/teamsBot.js)** - Main bot implementation that extends DialogBot, handles authentication, and processes user messages
4. **MainDialog (dialogs/mainDialog.js)** - OAuth authentication dialog flow using waterfall pattern

### Authentication Flow
The bot uses OAuth 2.0 authentication with the following pattern:
- Users must authenticate via `login` command
- Authentication state is managed both in memory and persistent storage
- Token validation is performed against external API endpoints
- Users can logout with `logout` command

### Service Layer
- **OpenAIService (services/openaiService.js)** - Handles AI chat completions with function calling for tools like vacation requests, document search, and employee lookup
- **ConversationService (services/conversationService.js)** - Manages conversation history and persistence
- **CosmosDB Config (config/cosmosConfigs.js)** - Handles CosmosDB connection with automatic retry logic

### Key Features
- **Vacation Management** - Users can request, simulate, and check vacation requests through adaptive cards
- **Document Search** - Azure Search integration for corporate document retrieval
- **Employee Directory** - Search functionality for employee information
- **Cafeteria Menu** - Daily menu lookup capability
- **Conversation History** - Persistent conversation storage in CosmosDB

## Common Development Patterns

### Error Handling
The codebase implements comprehensive error handling with:
- Graceful degradation when services are unavailable
- Automatic retry logic for external API calls
- User-friendly error messages
- Detailed logging for debugging

### State Management
- User authentication state is dual-tracked (memory + persistent storage)
- Conversation state is managed through Bot Framework's state management
- Dialog state is persisted for conversation continuity

### OAuth Token Management
- Tokens are validated against external endpoints
- Automatic token expiration handling
- Secure token storage in bot state

## Testing Notes
- Run `npm test` to execute the Jest test suite
- The bot includes health check endpoints at `/health` and `/metrics`
- Test OAuth flow requires proper environment configuration

## Deployment Notes
- The bot uses esbuild for bundling
- Node.js version 18-20 is required (specified in package.json engines)
- The application includes graceful shutdown handling for production deployment
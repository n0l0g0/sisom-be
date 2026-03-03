pipeline {
    agent any

    environment {
        // Shared Environment Variables
        COMPOSE_PROJECT_NAME = 'cozyhouse-sut'
        DB_URL = 'postgresql://admin:HC56LSedjxfuR5Nzgb1MV6zXcV45loiFXG@sisomapt-db:5432/cozyhouse?schema=public'
        
        // Frontend Config
        FE_PORT = '3001'
        FE_CONTAINER_NAME = 'cozyhouse-frontend'
        NEXT_PUBLIC_API_URL = 'https://cozyapi.washqueue.com'
        INTERNAL_API_URL = 'http://cozyhouse-backend:3000'
        
        // Backend Config
        BE_PORT = '3011'
        BE_CONTAINER_NAME = 'cozyhouse-backend'
        PUBLIC_API_URL = 'https://line-cozy.washqueue.com'
        API_URL = 'https://line-cozy.washqueue.com'
        INTERNAL_API_URL_BE = 'http://cozyhouse-backend:3000'
        
        // Line & SlipOK Config (Default values, will be overridden by DB settings)
        LIFF_ID = '2006834078-vJp0XqY3' 
        LINE_RICHMENU_GENERAL_ID = ''
        LINE_RICHMENU_TENANT_ID = ''
        LINE_RICHMENU_ADMIN_ID = ''
    }

    stages {
        stage('Checkout') {
            steps {
                // Checkout both repos
                dir('frontend') {
                    git branch: 'cozyhouse-sut', url: 'https://github.com/n0l0g0/sisom-fe.git'
                }
                dir('backend') {
                    git branch: 'cozyhouse-sut', url: 'https://github.com/n0l0g0/sisom-be.git'
                }
            }
        }

        stage('Prepare Configs') {
            steps {
                script {
                    // Generate docker-compose.yml for this deployment
                    writeFile file: 'docker-compose.yml', text: """
version: "2.2"
services:
  backend:
    build: ./backend
    container_name: ${BE_CONTAINER_NAME}
    ports:
      - "${BE_PORT}:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_URL=${DB_URL}
      - PUBLIC_API_URL=${PUBLIC_API_URL}
      - INTERNAL_API_URL=${INTERNAL_API_URL_BE}
      - API_URL=${API_URL}
      - LIFF_ID=${LIFF_ID}
    volumes:
      - /root/cozyhouse-uploads:/app/uploads
    restart: unless-stopped
    networks:
      - sisomapt-be_default

  frontend:
    build:
      context: ./frontend
      args:
        NEXT_PUBLIC_API_URL: "${NEXT_PUBLIC_API_URL}"
        INTERNAL_API_URL: "${INTERNAL_API_URL}"
    container_name: ${FE_CONTAINER_NAME}
    ports:
      - "${FE_PORT}:3000"
    environment:
      - NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
      - INTERNAL_API_URL=${INTERNAL_API_URL}
    restart: unless-stopped
    networks:
      - sisomapt-be_default

networks:
  sisomapt-be_default:
    external: true
"""
                }
            }
        }

        stage('Deploy') {
            steps {
                sh 'docker-compose up -d --build --force-recreate --remove-orphans'
            }
        }
        
        stage('Cleanup') {
            steps {
                sh 'docker image prune -f'
            }
        }
    }
}

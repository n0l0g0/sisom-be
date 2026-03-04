pipeline {
    agent any
    options { skipDefaultCheckout(true) }

    environment {
        COMPOSE_PROJECT_NAME = 'cozyhouse-be'
        BE_PORT = '3011'
        BE_CONTAINER_NAME = 'cozyhouse-backend'
        DB_URL = 'postgresql://admin:HC56LSedjxfuR5Nzgb1MV6zXcV45loiFXG@sisomapt-db:5432/cozyhouse?schema=public'
        PUBLIC_API_URL = 'https://line-cozy.washqueue.com'
        API_URL = 'https://line-cozy.washqueue.com'
        INTERNAL_API_URL_BE = 'http://cozyhouse-backend:3000'
        LIFF_ID = '2006834078-vJp0XqY3' 
    }

    stages {
        stage('Checkout') {
            steps {
                deleteDir()
                checkout scm
            }
        }

        stage('Prepare Configs') {
            steps {
                script {
                    writeFile file: 'docker-compose.yml', text: """
version: "2.2"
services:
  backend:
    build: .
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

networks:
  sisomapt-be_default:
    external: true
"""
                }
            }
        }
        
        stage('Build') {
            steps {
                sh 'docker-compose build backend'
            }
        }

        stage('Deploy') {
            steps {
                sh 'docker rm -f ${BE_CONTAINER_NAME} || true'
                sh 'docker-compose up -d --remove-orphans backend'
            }
        }
        
        stage('Cleanup') {
            steps {
                sh 'docker image prune -f'
            }
        }
    }
}

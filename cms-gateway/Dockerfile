FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./
EXPOSE 3011
ENV PORT=3011
CMD ["node", "server.js"]

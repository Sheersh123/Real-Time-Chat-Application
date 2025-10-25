FROM node:alpine
WORKDIR /app
COPY package.json* ./
RUN npm install --only=production
COPY . .
EXPOSE 3100
CMD ["node" , "server.js"]
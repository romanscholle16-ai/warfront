FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts
EXPOSE 2567
CMD ["node", "packages/server/dist/index.js"]

FROM node:22-alpine
WORKDIR /app
COPY server.mjs .
ENV PORT=8080
ENV COUNT_FILE=/data/visits.json
EXPOSE 8080
CMD ["node", "server.mjs"]

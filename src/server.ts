// server.ts
import App from "./app";
import * as dotenv from "dotenv";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const server: App = new App(); 
server.getHttpServer().listen(server.getPort(), () => {
  console.log(`App is running at http://localhost:${server.getPort()} in ${process.env.NODE_ENV} mode`);
});


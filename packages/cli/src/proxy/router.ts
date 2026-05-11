export type RouteHandler = (request: Request) => Promise<Response>;

interface Route {
  pattern: URLPattern;
  handler: RouteHandler;
}

export class ProxyRouter {
  private routes: Route[] = [];

  register(pattern: string, handler: RouteHandler): void {
    this.routes.push({
      pattern: new URLPattern({ pathname: pattern }),
      handler,
    });
  }

  async handle(request: Request): Promise<Response> {
    for (const route of this.routes) {
      if (route.pattern.test(request.url)) {
        return await route.handler(request);
      }
    }

    return new Response("Not Found", { status: 404 });
  }
}

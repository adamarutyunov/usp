import { publishTarget } from "../adapters/index.js";
import { Poster, type PostRequest } from "../pipeline/contracts.js";

export class AdapterPoster extends Poster {
  post(request: PostRequest) {
    return publishTarget(request);
  }
}

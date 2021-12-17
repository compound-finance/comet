import { Context, ContextCreator, World } from '../plugins/scenario'

export class CometActor {

}

export class CometAsset {

}

export class CometContext {
  actors: { [name: string]: CometActor};
  assets: { [name: string]: CometAsset};

  // XXX
  dog: string;

  constructor(world: World, dog: string) {
    // XXX wrap assets from world
    // XXX wrap actors from world
    this.dog = dog;
  }
}

export class CometContextCreator implements ContextCreator<CometContext> {
  async initContext(world: World): Promise<CometContext> {
    return new CometContext(world, 'spot'); // XXX
  }

  async forkContext(context: CometContext): Promise<CometContext> {
    return Object.assign({}, context); // XXX how to clone
  }
}

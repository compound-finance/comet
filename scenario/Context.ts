
export class CometContext {
  dog: string;

  constructor(dog: string) {
    this.dog = dog;
  }
}

export function getInitialContext(): CometContext {
  return new CometContext("spot");
}

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { CiteCodeComponent } from './app/citecode.component';

bootstrapApplication(CiteCodeComponent, appConfig).catch((err) => console.error(err));